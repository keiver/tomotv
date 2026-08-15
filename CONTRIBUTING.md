# Contributing to TomoTV

Thank you for your interest in contributing to TomoTV! This document provides guidelines for contributing to the project.

## Development Setup

See [CLAUDE-development.md](./CLAUDE-development.md) for detailed setup instructions.

**Quick Start:**

```bash
git clone https://github.com/keiver/tomotv.git
cd tomotv
npm install
npm start
```

Connect to your Jellyfin server from the in-app Settings screen (server IP + Quick
Connect code, or username/password).

## Code Quality Requirements

### Testing

- **Minimum coverage:** 60% overall
- All new features must include tests
- Run tests before submitting PR: `npm test`
- Check coverage: `npm run test:coverage`

### TypeScript

- Code must pass TypeScript strict mode: `npx tsc --noEmit --strict`
- No `@ts-ignore` or `@ts-expect-error` without justification
- Use proper types, not `any`

### Linting

- Code must pass ESLint: `npm run lint`
- Use Prettier for formatting (auto-fix on save)

### Accessibility

- All interactive elements must have `accessibilityLabel`
- Use `accessibilityRole` for semantic meaning
- Test with VoiceOver on iOS/tvOS

## Pull Request Process

1. **Branch Naming:**
   - Feature: `feature/description`
   - Bug fix: `fix/description`
   - Documentation: `docs/description`

2. **Commit Messages:**
   - Use present tense: "Add feature" not "Added feature"
   - Reference issues: "Fix #123: Description"
   - Keep first line under 72 characters

3. **PR Checklist:**
   - [ ] Tests pass (`npm test`)
   - [ ] Coverage stays above the floor in `jest.config.js` (`npm run test:coverage`), and rises rather than falls
   - [ ] TypeScript strict mode passes
   - [ ] ESLint passes (`npm run lint`)
   - [ ] Accessibility labels added to new components
   - [ ] Documentation updated if needed

4. **Review:**
   - At least 1 approval required
   - Address all review comments
   - Keep PRs focused (one feature/fix per PR)

## Code Style

### React/React Native

- Use functional components with hooks
- Use TypeScript interfaces for props
- Follow existing component structure
- Use React.memo for performance when appropriate

### Testing Patterns

- Follow patterns from `services/__tests__/libraryManager.test.ts`
- Use `jest.clearAllMocks()` in `beforeEach`
- Reset singleton state before each test
- Use fake timers for cache TTL tests
- Test error cases, not just happy paths

### File Organization

```
services/          # Business logic (singletons)
contexts/          # React context wrappers
hooks/             # Custom React hooks
components/        # Reusable UI components
app/               # Expo Router screens
types/             # TypeScript type definitions
utils/             # Utility functions
```

## Architecture Patterns

### Singleton Managers

- Use singleton pattern for global state (see `LibraryManager`, `PlayQueueManager`)
- Provide pub/sub for React integration via contexts
- Cache with TTL (5 min default)
- Prevent duplicate concurrent requests

### Error Handling

- Use structured logging: `logger.info()`, `logger.error()`
- Classify errors with specific types
- Provide user-friendly error messages
- Implement retry logic with exponential backoff

### Performance

- Use React.memo with custom comparison functions
- Lazy compute expensive operations (only when needed)
- Use disk-only image caching
- Avoid animations on large lists

## Questions?

- Open an issue for bugs or feature requests
- Check existing issues before creating new ones
- Tag maintainers for urgent issues

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
