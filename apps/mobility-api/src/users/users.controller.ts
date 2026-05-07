import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Req,
  UseInterceptors,
  UseGuards,
  ClassSerializerInterceptor,
  ParseIntPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateMeDto } from './dto/update-me.dto';

@UseInterceptors(ClassSerializerInterceptor)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  async newUser(@Body() body: CreateUserDto) {
    return this.usersService.newUser(body);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@Req() req: Request & { user: { id: number } }) {
    return this.usersService.getMeById(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateMe(
    @Req() req: Request & { user: { id: number } },
    @Body() body: UpdateMeDto,
  ) {
    return this.usersService.updateMeById(req.user.id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async getUserById(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.getUserById(id);
  }
}
