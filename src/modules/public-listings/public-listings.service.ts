import { Injectable } from '@nestjs/common';
import { AjoGroupStatus, AkawoPoolStatus, FoodAjoStatus } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

/** One public page: its short code, its title, and when it last changed. */
export interface ListedPage {
  readonly shortCode: string;
  readonly name: string;
  readonly updatedAt: string;
}

export interface PublicListings {
  readonly ajoGroups: ListedPage[];
  readonly akawoPools: ListedPage[];
  readonly foodProgrammes: ListedPage[];
}

/**
 * A sitemap's worth of anything is 50,000 URLs. Each kind is capped well under
 * a third of that, newest first, so the one sitemap the website builds stays
 * valid however many groups are listed.
 */
export const LISTINGS_PER_KIND = 10_000;

/**
 * Everything search engines may index, for the website's sitemap.
 *
 * Exactly the pages the public previews will describe, and no others: an Ajo
 * group or Akawo pool its organiser listed that still takes members, and a
 * Food Ajo programme that is open or running. An unlisted group never appears
 * here, since its page exists only for whoever was sent the link.
 */
@Injectable()
export class PublicListingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<PublicListings> {
    const select = { shortCode: true, name: true, updatedAt: true } as const;
    const [ajoGroups, akawoPools, foodProgrammes] = await Promise.all([
      this.prisma.ajoGroup.findMany({
        where: {
          publiclyListed: true,
          deletedAt: null,
          status: { in: [AjoGroupStatus.DRAFT, AjoGroupStatus.OPEN] },
        },
        select,
        orderBy: { updatedAt: 'desc' },
        take: LISTINGS_PER_KIND,
      }),
      this.prisma.akawoPool.findMany({
        where: { publiclyListed: true, status: AkawoPoolStatus.OPEN },
        select,
        orderBy: { updatedAt: 'desc' },
        take: LISTINGS_PER_KIND,
      }),
      this.prisma.foodAjoGroup.findMany({
        where: { status: { in: [FoodAjoStatus.OPEN, FoodAjoStatus.ACTIVE] } },
        select,
        orderBy: { updatedAt: 'desc' },
        take: LISTINGS_PER_KIND,
      }),
    ]);
    const page = (row: { shortCode: string; name: string; updatedAt: Date }): ListedPage => ({
      shortCode: row.shortCode,
      name: row.name,
      updatedAt: row.updatedAt.toISOString(),
    });
    return {
      ajoGroups: ajoGroups.map(page),
      akawoPools: akawoPools.map(page),
      foodProgrammes: foodProgrammes.map(page),
    };
  }
}
