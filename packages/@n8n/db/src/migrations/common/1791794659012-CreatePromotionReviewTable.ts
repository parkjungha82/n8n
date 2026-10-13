import type { MigrationContext, ReversibleMigration } from '../migration-types';

const runTable = 'promotion_run';
const reviewTable = 'promotion_review';
const configTable = 'promotion_config';
const userTable = 'user';

// Inlined on purpose: a migration must not import live enums from other packages.
const DIRECTIONS = ['promote', 'apply'];
const REVIEW_STATES = ['open', 'merged', 'closed'];

/**
 * A promotion run is one Promote or Apply. A promotion review is the host
 * review a Promote opened. The run holds what only n8n knows. The review holds
 * the host reference and the state. Title, URL and conflicts stay on the host.
 */
export class CreatePromotionReviewTable1791794659012 implements ReversibleMigration {
	async up({ schemaBuilder: { createTable, column }, tablePrefix }: MigrationContext) {
		await createTable(runTable)
			.withColumns(
				column('id').varchar(36).primary,
				column('configId')
					.varchar(36)
					.comment('The config this run used. NULL after the config is deleted.'),
				column('createdById').uuid.comment('The user who ran Promote or Apply.'),
				column('direction')
					.varchar(16)
					.notNull.withEnumCheck(DIRECTIONS)
					.comment(
						'PromotionDirection enum: "promote" pushes to the remote, "apply" imports from it. Copied from the config when the run is written.',
					),
				column('branchName').varchar(255).notNull.comment('The branch this run pushed or applied.'),
				column('commitSha').varchar(64).notNull.comment('The commit this run pushed or applied.'),
			)
			.withCreatedAt.withForeignKey('configId', {
				tableName: configTable,
				columnName: 'id',
				onDelete: 'SET NULL',
				name: `FK_${tablePrefix}promotion_run_configId`,
			})
			.withForeignKey('createdById', {
				tableName: userTable,
				columnName: 'id',
				onDelete: 'SET NULL',
				name: `FK_${tablePrefix}promotion_run_createdById`,
			})
			// Foreign key index, for the SET NULL when the config is deleted.
			.withIndexOn(['configId']);

		await createTable(reviewTable)
			.withColumns(
				column('id').varchar(36).primary,
				column('runId').varchar(36).notNull.comment('The promotion run that opened this review.'),
				column('remoteReviewId')
					.varchar(255)
					.notNull.comment(
						'Opaque reference to the review on the host. The prefix names the host kind, the rest is parsed by that host client, e.g. "gitlab:<projectId>!<iid>".',
					),
				column('state')
					.varchar(16)
					.notNull.default("'open'")
					.withEnumCheck(REVIEW_STATES)
					.comment(
						'PromotionReviewState enum: "open", "merged", "closed". Only "open" rows are refreshed from the host.',
					),
				column('mergedAt').timestampTimezone().comment('Mirrored from the host.'),
				column('closedAt').timestampTimezone().comment('Mirrored from the host.'),
				column('approvedById').uuid.comment(
					'The n8n user who approved the review in n8n. NULL when approval happened on the host.',
				),
				column('approvedAt').timestampTimezone(),
			)
			.withCreatedAt.withForeignKey('runId', {
				tableName: runTable,
				columnName: 'id',
				onDelete: 'CASCADE',
				name: `FK_${tablePrefix}promotion_review_runId`,
			})
			.withForeignKey('approvedById', {
				tableName: userTable,
				columnName: 'id',
				onDelete: 'SET NULL',
				name: `FK_${tablePrefix}promotion_review_approvedById`,
			})
			// The inbox lists by state and orders by creation time.
			.withIndexOn(['state', 'createdAt'])
			// Foreign key index, for the cascade when a run is deleted.
			.withIndexOn(['runId']);
	}

	async down({ schemaBuilder: { dropTable } }: MigrationContext) {
		await dropTable(reviewTable);
		await dropTable(runTable);
	}
}
