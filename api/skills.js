import { listSkills, matchSkillsByTriggers, listSkillsBySource, SKILL_SOURCES } from '../server/skills/skillLoader.js';

export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const url = new URL(req.url, 'http://localhost');
  const refresh = url.searchParams.get('refresh') === '1';
  const grouped = url.searchParams.get('grouped') === '1';

  if (url.pathname.endsWith('/match')) {
    const q = url.searchParams.get('q') || '';
    const matched = matchSkillsByTriggers(q);
    res.end(JSON.stringify({ ok: true, skills: matched, count: matched.length }));
    return;
  }

  if (grouped) {
    const bySource = listSkillsBySource();
    res.end(JSON.stringify({ ok: true, bySource, sources: SKILL_SOURCES }));
    return;
  }

  const skills = listSkills(refresh);
  res.end(JSON.stringify({ ok: true, skills, count: skills.length, sources: SKILL_SOURCES }));
}
