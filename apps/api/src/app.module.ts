import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from 'nestjs-prisma';
import { FlowModule } from './flow/flow.module';
import { AuthModule } from './auth/auth.module';
import { ProjectModule } from './project/project.module';

@Module({
  imports: [PrismaModule.forRoot({ isGlobal: true }), AuthModule, ProjectModule, FlowModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
