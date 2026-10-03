import { SignIn, SignUp, useUser } from '@clerk/react';
import React from 'react'
import { Navigate } from 'react-router-dom';

const Login = ({mode = "login"}) => {
    
    const isRegister = mode === "register";
    const {isLoaded, isSignedIn} = useUser()

    if(isLoaded && isSignedIn){
        return <Navigate to="/dashboard" replace/>
    }

  return (
    <div className="min-h-screen w-full bg-[url('/login_bg.png')] bg-cover bg-center bg-no-repeat bg-fixed text-slate-800 p-4 md:p-6 lg:p-8 flex items-center justify-center font-sans">
        <div className='w-full flex justify-center py-2'>
            {isRegister ? (
                <SignUp routing="path" path="/register" signInUrl="/login" fallbackRedirectUrl="/dashboard" signInFallbackRedirectUrl="/dashboard"/>
            ) : (
                <SignIn routing="path" path="/login" signUpUrl="/register" fallbackRedirectUrl="/dashboard" signUpFallbackRedirectUrl="/dashboard"/>
            )}
        </div>
    </div>
  )
}

export default Login