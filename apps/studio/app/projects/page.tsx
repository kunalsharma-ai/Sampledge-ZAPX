'use client';
import { Shell } from '@/components/Shell';
import { ProjectsSection } from '@/components/neon/ProjectsSection';

export default function ProjectsPage() {
  return (
    <Shell>
      <div className="nx-page-head">
        <h1>Projects</h1>
        <p className="muted">Each project holds its surveys and the sample vendors sending traffic to them.</p>
      </div>
      <ProjectsSection />
    </Shell>
  );
}
