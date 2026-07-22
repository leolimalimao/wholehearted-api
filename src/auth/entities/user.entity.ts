import { Column, Entity, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  spotifyId!: string;

  @Column()
  displayName!: string;

  @Column({ type: 'text' })
  encryptedRefreshToken!: string;

  @Column({ type: 'text', nullable: true })
  encryptedAccessToken!: string;

  @Column({ type: 'timestamptz', nullable: true })
  accessTokenExpiresAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}