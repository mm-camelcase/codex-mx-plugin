/** Validate the allowlisted project metadata returned by the protected reader. */
export function validateCatalog(value) {
  if (value?.version !== 1 || !Number.isFinite(Date.parse(value.capturedAt)) || !Array.isArray(value.projects) || value.projects.length > 1000) throw new Error('Invalid project catalog');
  const ids = new Set(), paths = new Set();
  for (const p of value.projects) {
    if (!p || typeof p.id !== 'string' || !p.id || typeof p.name !== 'string' || !p.name || p.name.length > 160 || typeof p.cwd !== 'string' || !p.cwd.startsWith('/') || ids.has(p.id) || paths.has(p.cwd)) throw new Error('Invalid project catalog entry');
    ids.add(p.id); paths.add(p.cwd);
    if (p.rootPaths !== undefined && (!Array.isArray(p.rootPaths) || !p.rootPaths.length || p.rootPaths.length > 100 || p.rootPaths[0] !== p.cwd || p.rootPaths.some(path => typeof path !== 'string' || !path.startsWith('/') || path.length > 4096) || new Set(p.rootPaths).size !== p.rootPaths.length)) throw new Error('Invalid project roots');
  }
  return value;
}

export function catalogProjects(folderGroups, catalog) {
  const projects = catalog.projects.map(p => ({ id: p.cwd, catalogId: p.id, name: p.name, cwd: p.cwd, threads: [] }));
  const byId = new Map(projects.map(p => [p.catalogId, p]));
  const exact = new Map();
  catalog.projects.forEach((p, index) => {
    for (const root of p.rootPaths || [p.cwd]) {
      // Shared roots are ambiguous unless a task has an explicit project assignment.
      exact.set(root, exact.has(root) ? null : projects[index]);
    }
  });
  const unmatched = [];
  for (const folder of folderGroups) {
    const remaining = [];
    for (const task of folder.threads) {
      // Explicit assignments win, followed by saved roots and verified worktree relationships.
      const owner = task.savedProjectId ? byId.get(task.savedProjectId) : exact.has(folder.cwd) ? exact.get(folder.cwd) : exact.get(task.repositoryRoot);
      if (owner) owner.threads.push({ ...task, projectId: owner.id });
      else remaining.push(task);
    }
    if (remaining.length) unmatched.push({ ...folder, threads: remaining });
  }
  for (const p of projects) p.threads.sort((a,b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  return { projects, unmatched };
}

export function disambiguateFolders(folders) {
  const counts = new Map();
  for (const folder of folders) counts.set(folder.name, (counts.get(folder.name) || 0) + 1);
  return folders.map(folder => ({ ...folder, name: counts.get(folder.name) > 1 ? `${folder.name} · ${folder.cwd.includes('/worktrees/') ? 'worktree ' + folder.cwd.split('/worktrees/')[1].split('/')[0] : folder.cwd.split('/').slice(-2,-1)[0]}` : folder.name }));
}
