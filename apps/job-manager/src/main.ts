import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { JobManagerModule } from './job-manager.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    JobManagerModule,
    {
      transport: Transport.TCP,
      options: {
        host: '0.0.0.0',
        port: Number(process.env.JOB_MANAGER_PORT) || 3001,
      },
    },
  );
  await app.listen();
  console.log('Job Manager microservice is running on TCP port', process.env.JOB_MANAGER_PORT || 3001);
}

bootstrap();
