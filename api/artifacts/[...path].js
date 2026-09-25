import { handleArtifactRequest } from '../../server/http/artifactHandlers.js';

export default async function handler(req, res) {
  const value = req.query?.path;
  const path = Array.isArray(value) ? value : String(value || '').split('/');
  return handleArtifactRequest(req, res, { path });
}
