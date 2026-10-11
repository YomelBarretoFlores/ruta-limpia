/** The account errors of the API, in words. */
export const USER_ERRORS = {
  username_taken: 'Ya existe una cuenta con ese usuario. Elige otro.',
  invalid_username:
    'El usuario debe tener de 3 a 32 caracteres: letras minúsculas, números, punto, guion o guion bajo.',
  weak_password: 'La contraseña debe tener al menos 12 caracteres (y como máximo 256).',
  cannot_modify_self: 'No puedes quitarte el rol de administrador ni desactivar tu propia cuenta.',
} as const;
