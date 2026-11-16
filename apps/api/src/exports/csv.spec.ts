import { describe, expect, it } from 'vitest';
import { csvCell, csvHeader, csvRow, localDateTime } from './csv';

describe('csvCell (§11.4)', () => {
  it.each([
    ['=HYPERLINK("http://x")', `"'=HYPERLINK(""http://x"")"`],
    ['+94771234567', "'+94771234567"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tcmd', "'\tcmd"],
    ['\rcmd', `"'\rcmd"`],
  ])('puts an apostrophe before a formula start: %j', (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });

  it('leaves ordinary text and numbers alone, and quotes commas, quotes and line breaks', () => {
    expect(csvCell('Silk Saree')).toBe('Silk Saree');
    expect(csvCell('1500.00')).toBe('1500.00');
    expect(csvCell(3)).toBe('3');
    expect(csvCell('12, Lake Road')).toBe('"12, Lake Road"');
    expect(csvCell('the "blue" one')).toBe('"the ""blue"" one"');
    expect(csvCell('line 1\nline 2')).toBe('"line 1\nline 2"');
    expect(csvCell('a = b')).toBe('a = b'); // only the first character matters
  });

  it('writes nothing for a missing value', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
});

describe('csvRow and csvHeader', () => {
  it('joins cells with commas and ends lines with CRLF; the file starts with a BOM', () => {
    expect(csvRow(['a', null, '=1'])).toBe("a,,'=1\r\n");
    expect(csvHeader(['Order', 'Total'])).toBe('﻿Order,Total\r\n');
  });
});

describe('localDateTime', () => {
  it('is the business’s clock, 24-hour', () => {
    expect(localDateTime(new Date('2026-10-31T18:45:00Z'), 'Asia/Colombo')).toBe(
      '2026-11-01 00:15',
    );
  });
});
