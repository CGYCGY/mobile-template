describe('test harness', () => {
  it('runs arithmetic', () => {
    expect(1 + 1).toBe(2);
  });

  it('resolves the @/ path alias', async () => {
    const mod = await import('@/lib/storage');
    expect(mod).toBeDefined();
  });
});
