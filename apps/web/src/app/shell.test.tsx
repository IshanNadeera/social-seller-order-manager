import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { strings } from '../lib/strings';
import { createFakeApi, memberMe } from '../test/fake-api';
import { createFakeAuth, fakeSession } from '../test/fake-auth';
import { renderApp } from '../test/render-app';
import { MAIN_CONTENT_ID } from './RootLayout';
import { NAV_ITEMS, PATHS } from './navigation';

const nav = strings.nav;

function renderShell(path = '/') {
  return renderApp(path, createFakeAuth(fakeSession()), createFakeApi({ me: memberMe({ name: 'Nimali Fashions' }) }));
}

/** The side navigation lives in the desktop sidebar (<aside>); the bottom bar does not. */
async function desktopNav() {
  const sidebar = await screen.findByRole('complementary');
  return within(sidebar);
}

async function mobileNav() {
  await screen.findByRole('complementary'); // wait for the shell
  const navs = screen.getAllByRole('navigation', { name: strings.shell.mainNav });
  const bottom = navs.find((element) => element.closest('aside') === null);
  if (!bottom) throw new Error('Mobile bottom navigation not found.');
  return bottom;
}

const linkNames = (container: HTMLElement) =>
  within(container)
    .getAllByRole('link')
    .map((link) => link.textContent?.trim());

describe('desktop side navigation (§6.1)', () => {
  it('lists the six sections in order, with links', async () => {
    renderShell();
    const sidebar = await desktopNav();
    const navigation = sidebar.getByRole('navigation', { name: strings.shell.mainNav });
    expect(linkNames(navigation)).toEqual([nav.dashboard, nav.orders, nav.customers, nav.products, nav.reports, nav.settings]);
    expect(within(navigation).getByRole('link', { name: nav.customers })).toHaveAttribute('href', PATHS.customers);
  });

  it('has a prominent New order button, the business name and Log out', async () => {
    renderShell();
    const sidebar = await desktopNav();
    expect(sidebar.getByRole('link', { name: nav.newOrder })).toHaveAttribute('href', PATHS.newOrder);
    expect(sidebar.getByText('Nimali Fashions')).toBeInTheDocument();
    expect(sidebar.getByRole('button', { name: strings.layout.logOut })).toBeInTheDocument();
  });

  it('marks the current section for screen readers', async () => {
    renderShell('/customers');
    const sidebar = await desktopNav();
    expect(sidebar.getByRole('link', { name: nav.customers })).toHaveAttribute('aria-current', 'page');
    expect(sidebar.getByRole('link', { name: nav.dashboard })).not.toHaveAttribute('aria-current');
  });
});

describe('mobile bottom navigation (§6.1)', () => {
  it('has Dashboard, Orders, + New order (centre), Customers and More', async () => {
    renderShell();
    const bottom = await mobileNav();
    expect(linkNames(bottom)).toEqual([nav.dashboard, nav.orders, nav.newOrder, nav.customers, nav.more]);
    expect(within(bottom).getByRole('link', { name: nav.newOrder })).toHaveAttribute('href', PATHS.newOrder);
  });

  it('opens New order from the centre button', async () => {
    const router = renderShell();
    const bottom = await mobileNav();
    await userEvent.click(within(bottom).getByRole('link', { name: nav.newOrder }));
    expect(router.state.location.pathname).toBe(PATHS.newOrder);
    expect(await screen.findByRole('heading', { level: 1, name: nav.newOrder })).toBeInTheDocument();
    expect(within(bottom).getByRole('link', { name: nav.newOrder })).toHaveAttribute('aria-current', 'page');
    // "Orders" is not also marked current on the new-order page.
    expect(within(bottom).getByRole('link', { name: nav.orders })).not.toHaveAttribute('aria-current');
  });

  it('lists Products, Reports, Settings and Log out under More, and keeps More current there', async () => {
    const router = renderShell();
    const bottom = await mobileNav();
    await userEvent.click(within(bottom).getByRole('link', { name: nav.more }));
    const main = await screen.findByRole('main');
    expect(await within(main).findByRole('heading', { level: 1, name: nav.more })).toBeInTheDocument();
    expect(linkNames(main)).toEqual([nav.products, nav.reports, nav.settings]);
    expect(within(main).getByRole('button', { name: strings.layout.logOut })).toBeInTheDocument();

    await userEvent.click(within(main).getByRole('link', { name: nav.settings }));
    expect(router.state.location.pathname).toBe(PATHS.settings);
    expect(within(bottom).getByRole('link', { name: nav.more })).toHaveAttribute('aria-current', 'page');
  });
});

describe('navigation rules', () => {
  it.each([
    ['dashboard', '/', true],
    ['dashboard', '/orders', false],
    ['orders', '/orders', true],
    ['orders', '/orders/123', true],
    ['orders', '/orders/new', false],
    ['newOrder', '/orders/new', true],
    ['customers', '/customers/abc', true],
    ['customers', '/customersx', false],
    ['more', '/more', true],
    ['more', '/settings', true],
    ['more', '/customers', false],
  ] as const)('%s is current at %s: %s', (key, pathname, expected) => {
    expect(NAV_ITEMS[key].isActive(pathname)).toBe(expected);
  });
});

describe('every link leads somewhere', () => {
  it.each(Object.values(NAV_ITEMS).filter((item) => item.key !== 'dashboard'))('$path shows its page', async (item) => {
    renderShell(item.path);
    expect(await screen.findByRole('heading', { level: 1, name: item.label })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: strings.notFound.title })).not.toBeInTheDocument();
  });
});

describe('keyboard use (§6.9)', () => {
  it('offers a skip link to the main content', async () => {
    renderShell();
    await screen.findByRole('complementary');
    const skip = screen.getByRole('link', { name: strings.shell.skipToContent });
    expect(skip).toHaveAttribute('href', `#${MAIN_CONTENT_ID}`);
    expect(screen.getByRole('main')).toHaveAttribute('id', MAIN_CONTENT_ID);
    await userEvent.tab();
    expect(skip).toHaveFocus(); // the first thing a keyboard user reaches
  });
});
