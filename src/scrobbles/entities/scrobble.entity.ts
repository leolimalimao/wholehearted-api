import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('scrobbles')
@Index(['trackSpotifyId', 'playedAt', 'userId'], { unique: true })
@Index(['userId', 'playedAt'])
@Index(['userId', 'artistName'])
export class Scrobble {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', nullable: false })
  userId!: string;

  @Column()
  trackSpotifyId!: string;

  @Column()
  trackName!: string;

  @Column()
  artistName!: string;

  @Column()
  albumName!: string;

  @Column({ nullable: true })
  albumImageUrl!: string;

  @Column({ type: 'timestamptz' })
  @Index()
  playedAt!: Date;
}