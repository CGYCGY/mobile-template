describe('test harness', () => {
  it('runs arithmetic', () => {
    expect(1 + 1).toBe(2);
  });

  it('resolves the @/ path alias', () => {
    // require (not dynamic import) so jest's CJS transform resolves the alias
    // without needing Node's --experimental-vm-modules flag.
    const mod = require('@/lib/storage');
    expect(mod).toBeDefined();
  });
});
