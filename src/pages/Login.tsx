import { signIn } from '../firebase';
import { useNavigate } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { toast } from 'sonner';

export default function Login() {
  const navigate = useNavigate();

  const handleLogin = async () => {
    try {
      await signIn();
      toast.success('Login realizado com sucesso!');
      navigate('/');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao fazer login. Tente novamente.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-4 transition-colors">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 border border-gray-100 dark:border-gray-700">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-blue-200 dark:shadow-none">
            <Building2 className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">AluguelMaster</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2 text-center">
            Gestão inteligente de contratos de aluguel residencial e comercial.
          </p>
        </div>

        <button
          onClick={handleLogin}
          className="w-full flex items-center justify-center gap-3 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold py-3 px-4 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-all shadow-sm active:scale-95"
        >
          <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
          Entrar com Google
        </button>

        <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-700 text-center">
          <p className="text-sm text-gray-400 dark:text-gray-500">
            Ao entrar, você concorda com nossos termos de serviço e política de privacidade.
          </p>
        </div>
      </div>
    </div>
  );
}
