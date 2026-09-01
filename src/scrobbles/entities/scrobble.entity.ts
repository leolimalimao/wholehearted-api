import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('scrobbles')
@Index(['trackSpotifyId', 'playedAt'], { unique: true }) // chave de dedup
export class Scrobble {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ nullable: true })
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