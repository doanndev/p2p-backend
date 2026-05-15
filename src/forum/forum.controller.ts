import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminJwtAuthGuard } from '../admins/guards/admin-jwt-auth.guard';
import { Admin } from '../admins/entities/admin.entity';
import { AdminPermissionReadForumGuard } from '../admins/guards/admin-permission-read-forum.guard';
import { AdminPermissionCreateForumGuard } from '../admins/guards/admin-permission-create-forum.guard';
import { AdminPermissionUpdateForumGuard } from '../admins/guards/admin-permission-update-forum.guard';
import { ForumService } from './forum.service';
import { QueryForumPostsDto } from './dto/query-forum-posts.dto';
import { QueryAdminForumPostsDto } from './dto/query-admin-forum-posts.dto';
import { CreateForumPostDto } from './dto/create-forum-post.dto';
import { UpdateForumPostDto } from './dto/update-forum-post.dto';

@ApiTags('Forum')
@ApiCookieAuth('access_token')
@Controller('forum/posts')
@UseGuards(JwtAuthGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class ForumPostsController {
  constructor(private readonly forumService: ForumService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List published forum posts (user)' })
  list(@Query() query: QueryForumPostsDto) {
    return this.forumService.listPublishedForUser(query);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get published forum post by id (user)' })
  @ApiParam({ name: 'id' })
  getOne(@Param('id', ParseIntPipe) id: number) {
    return this.forumService.getPublishedForUser(id);
  }
}

@ApiTags('Admin forum')
@ApiCookieAuth('admin_access_token')
@Controller('admin/forum/posts')
@UseGuards(AdminJwtAuthGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class AdminForumPostsController {
  constructor(private readonly forumService: ForumService) {}

  @Get()
  @UseGuards(AdminPermissionReadForumGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'List forum posts (admin; drafts and soft-deleted rows via query flags)',
  })
  listAdmin(@Query() query: QueryAdminForumPostsDto) {
    return this.forumService.listForAdmin(query);
  }

  @Get(':id')
  @UseGuards(AdminPermissionReadForumGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get forum post by id (admin)' })
  @ApiParam({ name: 'id' })
  getAdmin(@Param('id', ParseIntPipe) id: number) {
    return this.forumService.getForAdmin(id);
  }

  @Post()
  @UseGuards(AdminPermissionCreateForumGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create forum post (draft or published; published notifies all users)',
  })
  create(
    @Req() req: Request & { user: Admin },
    @Body() dto: CreateForumPostDto,
  ) {
    return this.forumService.createForAdmin(req.user.admin_id, dto);
  }

  @Patch(':id')
  @UseGuards(AdminPermissionUpdateForumGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Update post; first transition from draft to published notifies all users',
  })
  @ApiParam({ name: 'id' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateForumPostDto,
  ) {
    return this.forumService.updateForAdmin(id, dto);
  }

  @Delete(':id')
  @UseGuards(AdminPermissionUpdateForumGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete forum post' })
  @ApiParam({ name: 'id' })
  softDelete(@Param('id', ParseIntPipe) id: number) {
    return this.forumService.softDeleteForAdmin(id);
  }
}
