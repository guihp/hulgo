import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "sistema-hugo",
    build: process.env.NEXT_PUBLIC_BUILD_ID ?? null,
    timestamp: new Date().toISOString(),
  });
}
