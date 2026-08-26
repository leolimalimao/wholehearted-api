import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('tracks')
export class Track {
  @PrimaryColumn()
  spotifyId!: string;

  @Column()
  name!: string;

  @Column()
  artistName!: string; // desnormalizado pra query rápida

  @Column()
  artistSpotifyId!: string;

  @Column()
  albumName!: string;

  @Column({ nullable: true })
  albumImageUrl!: string;

  @Column()
  durationMs!: number;
}