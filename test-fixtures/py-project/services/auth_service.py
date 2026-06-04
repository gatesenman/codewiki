from typing import Optional, Dict
from .user_service import UserService, User
from .database import Database
from .logger import Logger


class AuthService:
    def __init__(self, user_service: UserService, db: Database, logger: Logger):
        self.user_service = user_service
        self.db = db
        self.logger = logger

    def login(self, email: str, password: str) -> Optional[Dict]:
        users = self.user_service.list_users()
        user = next((u for u in users if u.email == email), None)
        if not user:
            self.logger.warn(f"Login failed for {email}")
            return None
        token = self._generate_token(user)
        self.db.insert("sessions", {"token": token, "user_id": user.id})
        self.logger.info(f"User {user.id} logged in")
        return {"token": token, "user": vars(user)}

    def validate_token(self, token: str) -> Optional[User]:
        session = self.db.find_one("sessions", {"token": token})
        if not session:
            return None
        return self.user_service.get_user(session["user_id"])

    def logout(self, token: str) -> bool:
        return self.db.delete("sessions", {"token": token})

    def _generate_token(self, user: User) -> str:
        import hashlib
        import time
        raw = f"{user.id}:{time.time()}"
        return hashlib.sha256(raw.encode()).hexdigest()
