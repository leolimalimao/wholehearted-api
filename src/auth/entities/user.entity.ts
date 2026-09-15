import { Column, Entity, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  spotifyId!: string;

  @Column()
  displayName!: string;

  @Column({ unique: true })
  @Index()
  slug!: string; // novo campo — único e indexado pra busca rápida por URL

  @Column({ type: 'text', nullable: true })
  avatarUrl!: string | null;

  @Column({ type: 'text', select: false })
  encryptedRefreshToken!: string;

  @Column({ type: 'text', nullable: true, select: false })
  encryptedAccessToken!: string;

  @Column({ type: 'timestamptz', nullable: true })
  accessTokenExpiresAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}