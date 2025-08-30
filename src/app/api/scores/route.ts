import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const scores = await prisma.score.findMany({
      take: 10,
      orderBy: {
        score: 'desc',
      },
    });
    return NextResponse.json(scores);
  } catch (error) {
    console.error('Error fetching scores:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
