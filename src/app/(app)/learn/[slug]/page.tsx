import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { LessonView } from '@/components/learn/lesson-view';
import { KeepAlive } from '@/components/shell/keep-alive';
import { LESSON_BY_SLUG } from '@/lib/learn/curriculum';

export async function generateMetadata({ params }: PageProps<'/learn/[slug]'>): Promise<Metadata> {
  const lesson = LESSON_BY_SLUG.get((await params).slug);
  return { title: lesson ? `${lesson.title} · Learn` : 'Learn' };
}

export default async function LessonPage({ params }: PageProps<'/learn/[slug]'>) {
  const { slug } = await params;
  if (!LESSON_BY_SLUG.has(slug)) notFound();
  return (
    <KeepAlive>
      <LessonView slug={slug} />
    </KeepAlive>
  );
}
