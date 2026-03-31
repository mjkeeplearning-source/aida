import os


def pytest_configure(config):
    """Set required env vars before any app modules are imported."""
    os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
    os.environ.setdefault("TABLEAU_SERVER_URL", "https://test.tableau.com")
    os.environ.setdefault("TABLEAU_SITE_NAME", "testsite")
    os.environ.setdefault("TABLEAU_PAT_NAME", "testpat")
    os.environ.setdefault("TABLEAU_PAT_SECRET", "testsecret")
