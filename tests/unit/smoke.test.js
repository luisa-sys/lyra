describe('Test infrastructure', () => {
  it('should run unit tests successfully', () => {
    expect(true).toBe(true);
  });

  it('should generate valid slugs from display names', () => {
    const generateSlug = (name) => {
      return name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
    };

    expect(generateSlug('Sarah Ashworth')).toBe('sarah-ashworth');
    expect(generateSlug('  Multiple   Spaces  ')).toBe('multiple-spaces');
  });
});