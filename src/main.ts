/**
 * Application Entry Point
 *
 * Bootstraps the NestJS application with global configuration including:
 * - CORS support
 * - Global validation pipe for DTO validation
 * - Swagger documentation
 * - Graceful shutdown hooks
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  // Enable CORS for cross-origin requests
  app.enableCors();

  // Configure global validation pipe for automatic DTO validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Configure Swagger API documentation
  const config = new DocumentBuilder()
    .setTitle('Notification Gateway API')
    .setDescription(
      'Resilient notification gateway microservice with provider failover, idempotency, and rate limiting',
    )
    .setVersion('1.0')
    .addTag('notifications', 'Notification sending endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  logger.log(`Notification Gateway Service running on port ${port}`);
  logger.log(`API Documentation available at http://localhost:${port}/api`);
}

bootstrap();
