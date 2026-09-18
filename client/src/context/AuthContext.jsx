import React, { createContext, useState, useEffect } from 'react';
import axios from 'axios';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);




  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  };
  useEffect(() => {
    const loadUser = async () => {
      if (token) {
        try {
          // Ensure the header has the current token
          axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
          const res = await axios.get('http://localhost:5000/api/auth/me');
          setUser(res.data.data);
        } catch (err) {
          console.error('Session expired or invalid:', err);
          // Clear dead token and user
          logout();
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    };

    loadUser();
  }, [token]);


  const login = async (email, password) => {
    const res = await axios.post('http://localhost:5000/api/auth/login', { email, password });
    const { token, user: userData } = res.data.data;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`; // 👈 add this!
    setToken(token);
    setUser(userData);
  };


  const register = async (formData) => {
    const res = await axios.post('http://localhost:5000/api/auth/register', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return res.data;
  };




  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
