import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface JwtPayload {
  userId: string;
  spotifyId: string;
}

@Injectable()
export class JwtAuthService {
  constructor(private jwtService: JwtService) {}

  sign(payload: JwtPayload): string {
    return this.jwtService.sign(payload);
  }

  verify(token: string): JwtPayload {
    return this.jwtService.verify<JwtPayload>(token);
  }
}