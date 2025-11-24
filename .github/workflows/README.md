# CI/CD Workflows

This directory contains GitHub Actions workflows for automated testing, building, and deployment.

## Workflows

### `backend-ci.yml`
Main CI pipeline for backend that runs on every push and pull request:
- **Lint**: Runs ESLint to check code quality
- **Type Check**: Validates TypeScript types
- **Test**: Runs unit tests and generates coverage reports
- **Build**: Compiles TypeScript and verifies build artifacts
- **Security Audit**: Runs `npm audit` to check for vulnerabilities

**Triggers:**
- Push to `main`, `develop`, or `body` branches
- Pull requests to `main` or `develop`
- Only runs when files in `backend/` directory are changed

### `backend-integration-tests.yml`
Integration tests pipeline that runs on main branches:
- Sets up PostgreSQL and Redis services
- Runs database migrations
- Executes integration tests

**Triggers:**
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop`
- Manual trigger via `workflow_dispatch`

## Environment Variables

For integration tests, the following environment variables are automatically set:
- `DB_HOST`: localhost (PostgreSQL service)
- `DB_PORT`: 5432
- `DB_NAME`: travel_app_test
- `DB_USER`: travel_user
- `DB_PASSWORD`: travel_pass
- `REDIS_HOST`: localhost
- `REDIS_PORT`: 6379

## Coverage Reports

Coverage reports are uploaded to Codecov (if configured) after each test run. The coverage threshold is set to 70% in `jest.config.js`.

## Manual Triggers

You can manually trigger integration tests from the GitHub Actions tab:
1. Go to Actions → Backend Integration Tests
2. Click "Run workflow"
3. Select branch and click "Run workflow"

## Status Badges

Add these badges to your README.md:

```markdown
![Backend CI](https://github.com/YOUR_USERNAME/YOUR_REPO/workflows/Backend%20CI/badge.svg)
![Integration Tests](https://github.com/YOUR_USERNAME/YOUR_REPO/workflows/Backend%20Integration%20Tests/badge.svg)
```

