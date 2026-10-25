// Configuração do Firebase (compartilhada pelo site e pelo painel).
// Atenção: estes valores NÃO são senhas. Todo site Firebase expõe isso no navegador.
// A segurança de verdade vem das Regras do Realtime Database + Login Google (veja database.rules.json).
export const firebaseConfig = {
  apiKey: "AIzaSyCbr3SgZVJZuubqj8TGHaeBv8EJbCgXvn0",
  authDomain: "planilhasimple.firebaseapp.com",
  databaseURL: "https://planilhasimple-default-rtdb.firebaseio.com",
  projectId: "planilhasimple",
  storageBucket: "planilhasimple.firebasestorage.app",
  messagingSenderId: "71116250745",
  appId: "1:71116250745:web:51a2e7c27b2766f2f0bea8"
};
