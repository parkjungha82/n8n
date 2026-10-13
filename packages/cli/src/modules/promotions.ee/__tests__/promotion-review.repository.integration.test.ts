import { testDb, testModules } from '@n8n/backend-test-utils';
import type { User } from '@n8n/db';
import { UserRepository } from '@n8n/db';
import { Container } from '@n8n/di';

import { createMember, createOwner } from '@test-integration/db/users';

import { PromotionConfigRepository } from '../database/repositories/promotion-config.repository';
import { PromotionConnectionRepository } from '../database/repositories/promotion-connection.repository';
import { PromotionProviderRepository } from '../database/repositories/promotion-provider.repository';
import { PromotionReviewRepository } from '../database/repositories/promotion-review.repository';
import { PromotionRunRepository } from '../database/repositories/promotion-run.repository';

let providerRepository: PromotionProviderRepository;
let connectionRepository: PromotionConnectionRepository;
let configRepository: PromotionConfigRepository;
let runRepository: PromotionRunRepository;
let reviewRepository: PromotionReviewRepository;
let owner: User;
let connectionId: string;
let configId: string;

beforeAll(async () => {
	await testModules.loadModules(['promotions']);
	await testDb.init();

	providerRepository = Container.get(PromotionProviderRepository);
	connectionRepository = Container.get(PromotionConnectionRepository);
	configRepository = Container.get(PromotionConfigRepository);
	runRepository = Container.get(PromotionRunRepository);
	reviewRepository = Container.get(PromotionReviewRepository);
});

afterAll(async () => {
	await testDb.terminate();
});

beforeEach(async () => {
	// Delete children before parents to satisfy the foreign keys.
	await reviewRepository.delete({});
	await runRepository.delete({});
	await configRepository.delete({});
	await connectionRepository.delete({});
	await providerRepository.delete({});
	await testDb.truncate(['User']);
	owner = await createOwner();
	// Only one instance connection may exist, so every review of a test shares it.
	const provider = await providerRepository.insertProvider({
		name: 'repo',
		type: 'git',
		authType: 'token',
		config: { schemaVersion: 1 },
		auth: 'encrypted-repo',
	});
	const connection = await connectionRepository.insertConnection({
		name: 'repo',
		scope: 'instance',
		providerId: provider.id,
		target: { schemaVersion: 1, remoteUrl: 'https://example.com/org/repo.git' },
	});
	connectionId = connection.id;
	const config = await configRepository.insertConfig({
		connectionId,
		direction: 'promote',
		name: 'Promote',
		settings: { schemaVersion: 1, baseBranchName: 'main', createBranchOnPromotion: true },
	});
	configId = config.id;
});

let reviewCount = 0;

async function insertReview(over: { id?: string } = {}) {
	reviewCount += 1;
	const run = await runRepository.insertRun({
		configId,
		createdById: owner.id,
		direction: 'promote',
		branchName: `n8n-promotion/${reviewCount}`,
		commitSha: String(reviewCount).repeat(40).slice(0, 40),
	});
	const review = await reviewRepository.insertReview({
		id: over.id ?? `review-${reviewCount}`,
		runId: run.id,
		remoteReviewId: `gitlab:7!${reviewCount}`,
	});
	return { review, run };
}

describe('PromotionReviewRepository', () => {
	it('stores a new review as open with the id the caller chose', async () => {
		const { review, run } = await insertReview({ id: 'chosen-id' });

		const found = await reviewRepository.findByIdWithRelations('chosen-id');
		expect(found).toMatchObject({
			id: 'chosen-id',
			state: 'open',
			runId: run.id,
			remoteReviewId: review.remoteReviewId,
			mergedAt: null,
			closedAt: null,
			approvedById: null,
			approvedAt: null,
		});
		expect(found?.run).toMatchObject({
			direction: 'promote',
			branchName: run.branchName,
			commitSha: run.commitSha,
		});
		expect(found?.run?.createdBy?.id).toBe(owner.id);
		expect(found?.run?.config?.id).toBe(configId);
		expect(found?.run?.config?.connection?.id).toBe(connectionId);
		expect(found?.approvedBy).toBeNull();
	});

	it('keeps the review when its config or approver is deleted', async () => {
		const { review, run } = await insertReview();
		const member = await createMember();
		await reviewRepository.update(
			{ id: review.id },
			{ approvedById: member.id, approvedAt: new Date() },
		);

		await connectionRepository.delete({ id: connectionId });
		await Container.get(UserRepository).delete({ id: member.id });

		const found = await reviewRepository.findByIdWithRelations(review.id);
		expect(found).toMatchObject({ approvedById: null });
		expect(found?.run?.configId).toBeNull();
		expect(found?.run?.config).toBeNull();
		expect(found?.run?.direction).toBe('promote');
		expect(found?.run?.branchName).toBe(run.branchName);
		expect(found?.run?.commitSha).toBe(run.commitSha);
		expect(found?.approvedBy).toBeNull();
		expect(found?.run?.createdById).toBe(owner.id);
		expect(found?.run?.createdBy?.id).toBe(owner.id);
	});

	it('keeps the review when its creator is deleted', async () => {
		const { review } = await insertReview();

		await Container.get(UserRepository).delete({ id: owner.id });

		const found = await reviewRepository.findByIdWithRelations(review.id);
		expect(found?.run?.createdById).toBeNull();
		expect(found?.run?.createdBy).toBeNull();
	});

	it('lists newest first and filters by tab', async () => {
		const { review: first } = await insertReview();
		const { review: merged } = await insertReview();
		const { review: closed } = await insertReview();
		// Three inserts can share a millisecond, so pin the creation order.
		for (const [index, review] of [first, merged, closed].entries()) {
			await reviewRepository.update({ id: review.id }, { createdAt: new Date(1_000_000 * index) });
		}
		await reviewRepository.update(
			{ id: merged.id },
			{ state: 'merged', mergedAt: new Date(), closedAt: null },
		);
		await reviewRepository.update(
			{ id: closed.id },
			{ state: 'closed', mergedAt: null, closedAt: null },
		);

		const all = await reviewRepository.listReviews({ offset: 0, limit: 10 });
		expect(all.count).toBe(3);
		expect(all.data.map((r) => r.id)).toEqual([closed.id, merged.id, first.id]);

		const open = await reviewRepository.listReviews({ tab: 'open', offset: 0, limit: 10 });
		expect(open.data.map((r) => r.id)).toEqual([first.id]);

		const done = await reviewRepository.listReviews({ tab: 'closed', offset: 0, limit: 10 });
		expect(done.count).toBe(2);
		expect(done.data.map((r) => r.id)).toEqual([closed.id, merged.id]);

		const page = await reviewRepository.listReviews({ offset: 1, limit: 1 });
		expect(page.count).toBe(3);
		expect(page.data.map((r) => r.id)).toEqual([merged.id]);
	});

	it('pages stably when reviews share a creation time', async () => {
		const { review: olderId } = await insertReview({ id: 'review-a' });
		const { review: newerId } = await insertReview({ id: 'review-b' });
		const createdAt = new Date('2026-01-01T00:00:00.000Z');
		await reviewRepository.update({ id: olderId.id }, { createdAt });
		await reviewRepository.update({ id: newerId.id }, { createdAt });

		const first = await reviewRepository.listReviews({ offset: 0, limit: 1 });
		const second = await reviewRepository.listReviews({ offset: 1, limit: 1 });

		expect(first.data.map((r) => r.id)).toEqual(['review-b']);
		expect(second.data.map((r) => r.id)).toEqual(['review-a']);
	});
});
