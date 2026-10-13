import type { PromotionDirection } from '@n8n/api-types';
import { generateNanoId, User, WithCreatedAt } from '@n8n/db';
import {
	BeforeInsert,
	Column,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	PrimaryColumn,
	type Relation,
} from '@n8n/typeorm';

import { PromotionConfig } from './promotion-config.entity';

/**
 * One Promote or Apply. The row holds what n8n did: who ran it, which config,
 * which direction, and which commit. Direction is a copy, so the row can still
 * say Promote or Apply after the config is deleted. A host review, when one was
 * opened, lives on `promotion_review`.
 */
@Entity('promotion_run')
export class PromotionRun extends WithCreatedAt {
	@PrimaryColumn({ type: 'varchar', length: 36 })
	id: string;

	@BeforeInsert()
	generateId() {
		if (!this.id) this.id = generateNanoId();
	}

	@Index()
	@Column({ type: 'varchar', length: 36, nullable: true })
	configId: string | null;

	@Column({ type: 'uuid', nullable: true })
	createdById: string | null;

	/** Copied from the config when the run is written. A later config edit does not change it. */
	@Column({ type: 'varchar', length: 16 })
	direction: PromotionDirection;

	@Column({ type: 'varchar', length: 255 })
	branchName: string;

	/** The commit n8n pushed or applied. */
	@Column({ type: 'varchar', length: 64 })
	commitSha: string;

	@ManyToOne(() => PromotionConfig, { onDelete: 'SET NULL', nullable: true })
	@JoinColumn({ name: 'configId' })
	config: Relation<PromotionConfig> | null;

	@ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
	@JoinColumn({ name: 'createdById' })
	createdBy: Relation<User> | null;
}
