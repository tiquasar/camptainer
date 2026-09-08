import os

# Root of the backend package
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
# Project root (camptainer/) and a data dir for the SQLite DB
PROJECT_DIR = os.path.dirname(BACKEND_DIR)
DATA_DIR = os.path.join(PROJECT_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

DB_PATH = os.path.join(DATA_DIR, "camptainer.db")

# Every object Camptainer creates is tagged so the UI only ever shows
# containers/networks that this app owns.
APP_LABEL_KEY = "app"
APP_LABEL_VALUE = "camptainer"
LABEL_FILTER = f"{APP_LABEL_KEY}={APP_LABEL_VALUE}"
LABELS = {APP_LABEL_KEY: APP_LABEL_VALUE}

