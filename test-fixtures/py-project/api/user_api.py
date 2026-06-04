from typing import Dict
from ..services.user_service import UserService
from ..services.auth_service import AuthService


class UserAPI:
    def __init__(self, user_service: UserService, auth_service: AuthService):
        self.user_service = user_service
        self.auth_service = auth_service

    def handle_get_user(self, request: Dict) -> Dict:
        user_id = request.get("params", {}).get("id")
        token = request.get("headers", {}).get("authorization")
        if token:
            caller = self.auth_service.validate_token(token)
            if not caller:
                return {"status": 401, "error": "Unauthorized"}
        user = self.user_service.get_user(user_id)
        if not user:
            return {"status": 404, "error": "Not found"}
        return {"status": 200, "data": vars(user)}

    def handle_create_user(self, request: Dict) -> Dict:
        body = request.get("body", {})
        user = self.user_service.create_user(
            name=body.get("name", ""),
            email=body.get("email", ""),
            role=body.get("role", "user")
        )
        return {"status": 201, "data": vars(user)}
