import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: [
      'https://tapcanvas.beqlee.icu',
      'https://tapcanvas-api.beqlee.icu',
      'http://localhost:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
      // 开发环境允许所有本地地址
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
