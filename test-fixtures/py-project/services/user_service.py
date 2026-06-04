from typing import Optional, List, Dict
from .database import Database
from .logger import Logger


class User:
    def __init__(self, id: str, name: str, email: str, role: str = "user"):
        self.id = id
        self.name = name
        self.email = email
        self.role = role


class UserService:
    def __init__(self, db: Database, logger: Logger):
        self.db = db
        self.logger = logger

    def get_user(self, user_id: str) -> Optional[User]:
        self.logger.info(f"Fetching user {user_id}")
        data = self.db.find_one("users", {"id": user_id})
        if data:
            return User(**data)
        return None

    def create_user(self, name: str, email: str, role: str = "user") -> User:
        import uuid
        user = User(id=str(uuid.uuid4()), name=name, email=email, role=role)
        self.db.insert("users", vars(user))
        self.logger.info(f"Created user {user.id}")
        return user

    def update_user(self, user_id: str, updates: Dict) -> Optional[User]:
        user = self.get_user(user_id)
        if not user:
            return None
        for key, value in updates.items():
            setattr(user, key, value)
        self.db.update("users", {"id": user_id}, vars(user))
        return user

    def delete_user(self, user_id: str) -> bool:
        self.logger.warn(f"Deleting user {user_id}")
        return self.db.delete("users", {"id": user_id})

    def list_users(self, role: Optional[str] = None) -> List[User]:
        filter_dict = {"role": role} if role else {}
        results = self.db.find("users", filter_dict)
        return [User(**data) for data in results]
