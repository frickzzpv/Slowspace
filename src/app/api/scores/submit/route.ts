import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { playerName, score } = body;

    if (!playerName || typeof score !== 'number') {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    const newScore = await prisma.score.create({
      data: {
        playerName,
        score,
      },
    });

    return NextResponse.json(newScore, { status: 201 });
  } catch (error) {
    console.error('Error creating score:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
