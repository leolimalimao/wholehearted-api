import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('artists')
export class Artist {
  @PrimaryColumn()
  spotifyId!: string;

  @Column()
  name!: string;
}