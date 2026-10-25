// Configuração do Firebase (compartilhada pelo site e pelo painel).
// Atenção: estes valores NÃO são senhas. Todo site Firebase expõe isso no navegador.
// A segurança de verdade vem das Regras do Realtime Database + Login Google (veja database.rules.json).
export const firebaseConfig = {
  apiKey: "AIzaSyBZbalgNCOg-_Y8qZN1w1QZ5ed_OLP2jF4",
  authDomain: "excellentservicesportfolio.firebaseapp.com",
  // CONFIRME este endereço em Firebase > Realtime Database (aparece no topo da aba "Dados").
  // Se o seu banco estiver em outra região, ele termina em .firebasedatabase.app em vez de .firebaseio.com
  databaseURL: "https://excellentservicesportfolio-default-rtdb.firebaseio.com",
  projectId: "excellentservicesportfolio",
  storageBucket: "excellentservicesportfolio.firebasestorage.app",
  messagingSenderId: "904823075725",
  appId: "1:904823075725:web:753f6bacd68061b1f483c4"
};
