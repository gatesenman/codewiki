import logging
from typing import Any


class Logger:
    def __init__(self, name: str = "app"):
        self._logger = logging.getLogger(name)

    def info(self, message: str) -> None:
        self._logger.info(message)

    def warn(self, message: str) -> None:
        self._logger.warning(message)

    def error(self, message: str, error: Any = None) -> None:
        self._logger.error(message, exc_info=error)
