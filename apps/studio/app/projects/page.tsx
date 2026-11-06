'use client';
import { Shell } from '@/components/Shell';
import { ProjectsSection } from '@/components/neon/ProjectsSection';
import { PageHeader } from '@/components/neon/PageHeader';
import { FolderKanban } from 'lucide-react';

export default function ProjectsPage() {
  return (
    <Shell>
      <PageHeader icon={FolderKanban} eyebrow="Workspace" title="Projects" help="page.projects">
        Each project holds its surveys and the sample vendors sending traffic to them.
      </PageHeader>
      <ProjectsSection />
    </Shell>
  );
}
