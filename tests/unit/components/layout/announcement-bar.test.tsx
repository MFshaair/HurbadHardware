import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnouncementBar } from '@/components/layout/announcement-bar';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

describe('announcement dismissal', () => {
  it('hides an empty announcement', () => {
    render(<AnnouncementBar message="" />);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });
  it('remembers dismissal, but displays a new announcement', async () => {
    const view = render(<AnnouncementBar message="Delivery update" />);
    await userEvent.click(screen.getByRole('button', { name: 'announcementDismiss' }));
    expect(screen.queryByText('Delivery update')).not.toBeInTheDocument();
    view.unmount();
    const restored = render(<AnnouncementBar message="Delivery update" />);
    expect(screen.queryByText('Delivery update')).not.toBeInTheDocument();
    restored.rerender(<AnnouncementBar message="New delivery update" />);
    expect(screen.getByText('New delivery update')).toBeInTheDocument();
  });
});
