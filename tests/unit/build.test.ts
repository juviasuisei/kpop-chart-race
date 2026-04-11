import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const root = process.cwd();

describe('Build smoke tests', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));

  it('should have no framework dependencies (Req 10.2)', () => {
    const frameworks = ['react', 'vue', 'angular', 'svelte'];
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    for (const fw of frameworks) {
      const matches = Object.keys(allDeps).filter(
        (dep) => dep === fw || dep.startsWith(`${fw}-`) || dep.startsWith(`@${fw}/`),
      );
      expect(matches).toEqual([]);
    }
  });

  it('should use vitest as test runner (Req 10.5)', () => {
    expect(pkg.devDependencies).toHaveProperty('vitest');
  });

  it('should have a build script (Req 10.1)', () => {
    expect(pkg.scripts).toHaveProperty('build');
    expect(pkg.scripts.build).toBeTruthy();
  });

  it('should have vite.config.ts with base path for GitHub Pages', () => {
    const configPath = join(root, 'vite.config.ts');
    expect(existsSync(configPath)).toBe(true);

    const content = readFileSync(configPath, 'utf-8');
    expect(content).toMatch(/base\s*:/);
  });

  it('should have GitHub Actions workflow at .github/workflows/deploy.yml (Req 10.4)', () => {
    const workflowPath = join(root, '.github', 'workflows', 'deploy.yml');
    expect(existsSync(workflowPath)).toBe(true);
  });
});
