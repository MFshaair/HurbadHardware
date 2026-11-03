import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
afterEach(cleanup);
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
import { OtpInput } from '@/components/forms/otp-input';

describe('OtpInput', () => {
  it('renders six single-digit boxes', () => {
    render(<OtpInput label="Enter the 6-digit code" onComplete={vi.fn()} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
  });

  it('advances focus and fires onComplete with the full code', async () => {
    const onComplete = vi.fn();
    render(<OtpInput label="Enter the 6-digit code" onComplete={onComplete} />);
    const boxes = screen.getAllByRole('textbox');
    await userEvent.click(boxes[0]!);
    await userEvent.keyboard('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
    expect(boxes[5]).toHaveFocus();
  });

  it('accepts a pasted code', async () => {
    const onComplete = vi.fn();
    render(<OtpInput label="Enter the 6-digit code" onComplete={onComplete} />);
    await userEvent.click(screen.getAllByRole('textbox')[0]!);
    await userEvent.paste('987654');
    expect(onComplete).toHaveBeenCalledWith('987654');
  });

  it('moves back on backspace in an empty box', async () => {
    render(<OtpInput label="Enter the 6-digit code" onComplete={vi.fn()} />);
    const boxes = screen.getAllByRole('textbox');
    await userEvent.click(boxes[0]!);
    await userEvent.keyboard('12');
    await userEvent.keyboard('{Backspace}{Backspace}');
    expect(boxes[0]).toHaveFocus();
  });

  it('ignores non-digits', async () => {
    const onComplete = vi.fn();
    render(<OtpInput label="Enter the 6-digit code" onComplete={onComplete} />);
    await userEvent.click(screen.getAllByRole('textbox')[0]!);
    await userEvent.keyboard('a1b2c3d4e5f6');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });
});
