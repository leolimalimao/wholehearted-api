import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getLoggerToken } from 'nestjs-pino';
import { SyncService } from './sync.service';
import { SYNC_QUEUE } from './sync.processor';
import { User } from '../auth/entities/user.entity';

describe('SyncService', () => {
  let service: SyncService;
  let syncQueue: jest.Mocked<any>;
  let userRepo: jest.Mocked<any>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        SyncService,
        {
          provide: getQueueToken(SYNC_QUEUE),
          useValue: {
            getJobSchedulers: jest.fn(),
            removeJobScheduler: jest.fn(),
            upsertJobScheduler: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: getLoggerToken(SyncService.name),
          useValue: {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(SyncService);
    syncQueue = module.get(getQueueToken(SYNC_QUEUE));
    userRepo = module.get(getRepositoryToken(User));
  });

  describe('onModuleInit', () => {
    it('remove agendamentos órfãos e projeta apenas o id dos usuários cadastrados', async () => {
      // Arrange
      syncQueue.getJobSchedulers.mockResolvedValue([
        { key: 'scheduler-key-1' },
        { key: 'scheduler-key-2' },
      ]);
      syncQueue.removeJobScheduler.mockResolvedValue(true);
      userRepo.find.mockResolvedValue([
        { id: 'user-1' },
        { id: 'user-2' },
      ]);
      syncQueue.upsertJobScheduler.mockResolvedValue({});

      // Act
      await service.onModuleInit();

      // Assert
      expect(syncQueue.removeJobScheduler).toHaveBeenCalledTimes(2);
      expect(syncQueue.removeJobScheduler).toHaveBeenCalledWith('scheduler-key-1');
      expect(syncQueue.removeJobScheduler).toHaveBeenCalledWith('scheduler-key-2');

      // Verifica que buscou com select restrito (sem carregar tokens na memória)
      expect(userRepo.find).toHaveBeenCalledWith({
        select: { id: true },
      });

      expect(syncQueue.upsertJobScheduler).toHaveBeenCalledTimes(2);
      expect(syncQueue.upsertJobScheduler).toHaveBeenCalledWith(
        'recently-played-sync:user-1',
        expect.any(Object),
        expect.objectContaining({
          data: { userId: 'user-1' },
        }),
      );
      expect(syncQueue.upsertJobScheduler).toHaveBeenCalledWith(
        'recently-played-sync:user-2',
        expect.any(Object),
        expect.objectContaining({
          data: { userId: 'user-2' },
        }),
      );
    });

    it('não registra jobs quando a tabela de usuários estiver vazia', async () => {
      // Arrange
      syncQueue.getJobSchedulers.mockResolvedValue([]);
      userRepo.find.mockResolvedValue([]);

      // Act
      await service.onModuleInit();

      // Assert
      expect(userRepo.find).toHaveBeenCalledWith({
        select: { id: true },
      });
      expect(syncQueue.upsertJobScheduler).not.toHaveBeenCalled();
    });

    it('captura erro e não quebra a inicialização da aplicação em caso de falha', async () => {
      // Arrange
      syncQueue.getJobSchedulers.mockRejectedValue(new Error('Redis connection failed'));

      // Act & Assert
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('registerSyncForUser', () => {
    it('registra job com as opções e backoff configurados', async () => {
      // Arrange
      syncQueue.upsertJobScheduler.mockResolvedValue({});

      // Act
      await service.registerSyncForUser('user-uuid-123');

      // Assert
      expect(syncQueue.upsertJobScheduler).toHaveBeenCalledWith(
        'recently-played-sync:user-uuid-123',
        { every: 180000 },
        expect.objectContaining({
          name: 'recently-played-sync',
          data: { userId: 'user-uuid-123' },
          opts: expect.objectContaining({
            removeOnComplete: 3,
            removeOnFail: 2,
            attempts: 2,
            backoff: { type: 'exponential', delay: 30000 },
          }),
        }),
      );
    });

    it('relança o erro se a fila do BullMQ falhar', async () => {
      // Arrange
      syncQueue.upsertJobScheduler.mockRejectedValue(new Error('Queue unavailable'));

      // Act & Assert
      await expect(service.registerSyncForUser('user-uuid-123')).rejects.toThrow('Queue unavailable');
    });
  });
});
