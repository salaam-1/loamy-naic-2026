/**
 * Accessibility text: aria-labels, screen-reader-only announcements and the
 * names of controls that show only an icon.
 *
 * These are localized for the same reason visible text is. A screen-reader user
 * who has set Loamy to Hausa should not hear "Account menu" in English, and an
 * icon-only control with an English name is simply unlabelled to them.
 */
export const a11y = {
  'a11y.accountMenu': 'Account menu',
  'a11y.mainNavigation': 'Main',
  'a11y.primaryNavigation': 'Primary',
  'a11y.toggleNavigation': 'Toggle navigation',
  'a11y.openMenu': 'Open menu',
  'a11y.closeMenu': 'Close menu',
  'a11y.goHome': 'Go to your dashboard',
  'a11y.goHomePublic': 'Go to the Loamy home page',
  'a11y.cart': 'Cart',
  'a11y.cartWithCount': 'Cart ({count})',
  'a11y.savedItems': 'Saved items',
  'a11y.savedItemsWithCount': 'Saved items ({count})',
  'a11y.orders': 'Orders',
  'a11y.notifications': 'Notifications',
  'a11y.notificationsUnread': 'Notifications ({count} unread)',
  'a11y.loading': 'Loading',
  'a11y.loadingNamed': 'Loading {what}',
  'a11y.required': 'required',
  'a11y.sortBy': 'Sort by',
  'a11y.filterBy': 'Filter by {field}',
  'a11y.addedToCartAnnouncement': 'Added to cart. {count} item in cart.',
  'a11y.addedToCartAnnouncement_plural': 'Added to cart. {count} items in cart.',
  'a11y.languageChanged': 'Language changed to {language}.',
} as const
