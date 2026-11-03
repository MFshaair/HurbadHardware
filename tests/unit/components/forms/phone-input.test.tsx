import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
afterEach(cleanup);
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
import { PhoneInput } from '@/components/forms/phone-input';

function Harness({ onChange }: { onChange: (v: { e164: string | null; valid: boolean }) => void }) {
  return <PhoneInput label="Phone number" defaultCountry="SO" onChange={onChange} />;
}

describe('PhoneInput (07 §4)', () => {
  it('offers only the five supported countries', () => {
    render(<Harness onChange={vi.fn()} />);
    const select = screen.getByRole('combobox', { name: /country/i });
    expect(select.querySelectorAll('option')).toHaveLength(5);
    expect(screen.getByRole('option', { name: /\+252/ })).toBeInTheDocument();
  });

  it('emits E.164 and validity as the user types', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Phone number'), '612345678');
    expect(onChange).toHaveBeenLastCalledWith({ e164: '+252612345678', valid: true });
  });

  it('reports invalid input without throwing', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Phone number'), '12');
    expect(onChange).toHaveBeenLastCalledWith({ e164: null, valid: false });
  });

  it('switches the prefix when the country changes', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /country/i }), 'KE');
    await userEvent.type(screen.getByLabelText('Phone number'), '712345678');
    expect(onChange).toHaveBeenLastCalledWith({ e164: '+254712345678', valid: true });
  });
});
