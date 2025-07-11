import { getDashboardData, getUserAccounts } from '@/actions/dashboard';
import { getCurrentBudget } from '@/actions/budget';

import CreateAccountDrawer from '@/components/account-drawer';
import { Card, CardContent } from '@/components/ui/card';
import { Plus } from 'lucide-react';

import { DashboardOverview } from './_components/transaction';
import { BudgetProgress } from './_components/budget-progress';
import { AccountCard } from './_components/account-card';

export default async function DashboardPage() {
  const [accounts, transactions] = await Promise.all([
    getUserAccounts(),
    getDashboardData(),
  ]);

  const defaultAccount = accounts?.find((account) => account.isDefault);

  // Get budget for default account
  let budgetData = null;
  if (defaultAccount) {
    budgetData = await getCurrentBudget(defaultAccount.id);
  }

  return (
    <div className="px-5">
      {/* Budget progress */}
      <BudgetProgress
        initialBudget={budgetData?.budget}
        currentExpenses={budgetData?.currentExpenses || 0}
      />

      {/* Overview */}
      <DashboardOverview
        accounts={accounts}
        transactions={transactions || []}
      />

      {/* Account Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <CreateAccountDrawer>
          <Card className="hover:shadow-lg transition-shadow duration-200 ease-in-out cursor-pointer mt-4">
            <CardContent className="flex flex-col items-center justify-center text-muted-foreground text-center h-full">
              <Plus className="h-10 w-10 mb-2" />
              <p className="text-sm font-medium">Add New Account</p>
            </CardContent>
          </Card>
        </CreateAccountDrawer>

        {accounts.length > 0 &&
          accounts.map((account) => (
            <AccountCard key={account.id} account={account} />
          ))}
      </div>
    </div>
  );
}
