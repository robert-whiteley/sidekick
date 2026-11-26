import { calculateTool, convertTool, dateTool, timeInTool } from '../src/integrations/compute';

const now = new Date(2026, 10, 26, 14, 30); // Thursday 26 November 2026

describe('calculate', () => {
  it('works out sums the model writes', () => {
    expect(calculateTool('17*23')).toBe('17 × 23 is 391.');
    expect(calculateTool('15%*240')).toMatch(/is 36\.$/);
    expect(calculateTool('(3*12)-7-2')).toMatch(/is 27\.$/);
    expect(calculateTool('sqrt(144)')).toMatch(/is 12\.$/);
    expect(calculateTool('2**10')).toMatch(/is 1,024\.$/);
    expect(calculateTool('1,200/4')).toMatch(/is 300\.$/);
  });
  it('refuses what is not a sum', () => {
    expect(calculateTool('pizza')).toBeNull();
    expect(calculateTool('1/0')).toBeNull();
  });
});

describe('convert', () => {
  it('converts units', () => {
    expect(convertTool(2, 'kg', 'pounds')).toMatch(/4\.40925 pounds/);
    expect(convertTool(2.5, 'litres', 'ml')).toMatch(/2,500/);
    expect(convertTool(100, 'f', 'c')).toMatch(/37\.8°C/);
  });
  it('refuses mismatched units', () => {
    expect(convertTool(2, 'kg', 'km')).toBeNull();
  });
});

describe('date', () => {
  it('answers calendar facts', () => {
    expect(dateTool({ ask: 'today' }, now)).toBe('Today is Thursday 26 November 2026.');
    expect(dateTool({ ask: 'days_until', date: '2026-12-25' }, now)).toMatch(/^29 days until/);
    expect(dateTool({ ask: 'days_since', date: '2026-11-20' }, now)).toMatch(/^6 days since/);
    expect(dateTool({ ask: 'weekday', date: '2027-01-01' }, now)).toMatch(/is a Friday/);
    expect(dateTool({ ask: 'leap_year', year: 2028 }, now)).toMatch(/^Yes/);
    expect(dateTool({ ask: 'leap_year', year: 2100 }, now)).toMatch(/^No/);
    expect(dateTool({ ask: 'days_in_month', month: 2, year: 2028 }, now)).toMatch(/29 days/);
    expect(dateTool({ ask: 'add_days', days: 3 }, now)).toMatch(/Sunday 29 November/);
  });
  it('needs its arguments', () => {
    expect(dateTool({ ask: 'days_until' }, now)).toBeNull();
    expect(dateTool({ ask: 'weekday', date: '2026-02-30' }, now)).toBeNull();
  });
});

describe('time in', () => {
  it('knows big cities', () => {
    expect(timeInTool('Tokyo', now)).toMatch(/in Tokyo/);
    expect(timeInTool('Atlantis', now)).toBeNull();
  });
});
