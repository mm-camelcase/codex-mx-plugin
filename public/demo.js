const definitions = [
  ['Infrastructure', 'infra', [['ECS deployment', 'needs-attention'], ['Terraform plan', 'working'], ['AWS sign-in', 'idle'], ['Container logs', 'working'], ['Network policy', 'done'], ['RDS connection', 'idle'], ['IAM cleanup', 'done'], ['Cost report', 'idle']]],
  ['Agentic', 'agentic', [['Research workflow', 'working'], ['Ranking model', 'working'], ['Source sync', 'idle']]],
  ['Brain', 'brain', [['Weekly digest', 'done'], ['Index refresh', 'done']]],
  ['Platform', 'platform', [['Review migration', 'needs-attention'], ['API performance', 'working']]],
  ['Portfolio', 'portfolio', [['Case study', 'working'], ['Image audit', 'idle']]],
  ['CLI tools', 'cli', [['Release build', 'error'], ['Command palette', 'idle']]],
  ['Playground', 'playground', [['Canvas experiment', 'idle']]],
  ['Design system', 'design', [['Keyboard focus', 'done']]]
];
export function demoProjects() {
  return definitions.map(([name, id, tasks]) => ({ id, name, cwd: `/demo/${id}`, threads: tasks.map(([name, state], i) => ({
    id: `demo-${id}-${i}`, projectId: id, cwd: `/demo/${id}`, name, state,
    preview: state === 'needs-attention' ? 'The agent is waiting for your review before continuing.' : 'Sample task for exploring the keypad. No real work is running.',
    updatedAt: Date.now() - i * 60000,
    rawStatus: state === 'needs-attention' ? { type: 'active', activeFlags: ['waitingOnApproval'] } : state === 'working' ? { type: 'active', activeFlags: [] } : { type: 'idle' }
  })) }));
}
